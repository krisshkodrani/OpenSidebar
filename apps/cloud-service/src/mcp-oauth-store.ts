import type { Pool, PoolClient } from "pg";

export type McpGrant = {
  hash: string;
  kind: "code" | "access" | "refresh";
  family: string;
  accountId: string;
  deviceId: string;
  epoch: number;
  clientId: string;
  resource: string;
  scopes: string[];
  redirectUri?: string;
  challenge?: string;
  expiresAt: Date;
  familyExpiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
};
export interface McpOAuthStore {
  put(grant: McpGrant): Promise<void>;
  get(hash: string): Promise<McpGrant | null>;
  exchange(
    hash: string,
    valid: (grant: McpGrant) => boolean,
    issue: (grant: McpGrant) => McpGrant[],
  ): Promise<boolean>;
  revoke(hash: string, clientId: string): Promise<void>;
}
const rowGrant = (row: Record<string, unknown>): McpGrant => ({
  hash: String(row.token_hash),
  kind: row.kind as McpGrant["kind"],
  family: String(row.family_id),
  accountId: String(row.account_id),
  deviceId: String(row.device_id),
  epoch: Number(row.session_epoch),
  clientId: String(row.client_id),
  resource: String(row.resource),
  scopes: row.scopes as string[],
  redirectUri: row.redirect_uri as string | undefined,
  challenge: row.challenge as string | undefined,
  expiresAt: new Date(String(row.expires_at)),
  familyExpiresAt: new Date(String(row.family_expires_at)),
  ...(row.used_at ? { usedAt: new Date(String(row.used_at)) } : {}),
  ...(row.revoked_at ? { revokedAt: new Date(String(row.revoked_at)) } : {}),
});
async function insert(db: Pool | PoolClient, g: McpGrant) {
  await db.query(
    `INSERT INTO control.mcp_oauth_grants
    (token_hash,kind,family_id,account_id,device_id,session_epoch,client_id,resource,scopes,redirect_uri,challenge,expires_at,family_expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      g.hash,
      g.kind,
      g.family,
      g.accountId,
      g.deviceId,
      g.epoch,
      g.clientId,
      g.resource,
      g.scopes,
      g.redirectUri,
      g.challenge,
      g.expiresAt,
      g.familyExpiresAt,
    ],
  );
}
export class PostgresMcpOAuthStore implements McpOAuthStore {
  constructor(private readonly pool: Pool) {}
  async put(g: McpGrant) {
    await insert(this.pool, g);
  }
  async get(hash: string) {
    const r = await this.pool.query(
      "SELECT * FROM control.mcp_oauth_grants WHERE token_hash=$1",
      [hash],
    );
    return r.rows[0] ? rowGrant(r.rows[0]) : null;
  }
  async exchange(
    hash: string,
    valid: (g: McpGrant) => boolean,
    issue: (g: McpGrant) => McpGrant[],
  ) {
    const first = await this.get(hash);
    if (!first) return false;
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        first.family,
      ]);
      const r = await db.query(
        "SELECT * FROM control.mcp_oauth_grants WHERE token_hash=$1 FOR UPDATE",
        [hash],
      );
      const g = r.rows[0] ? rowGrant(r.rows[0]) : null;
      if (
        !g ||
        !valid(g) ||
        g.revokedAt ||
        g.expiresAt.getTime() <= Date.now()
      ) {
        await db.query("ROLLBACK");
        return false;
      }
      if (g.usedAt) {
        await db.query(
          "UPDATE control.mcp_oauth_grants SET revoked_at=now() WHERE family_id=$1",
          [g.family],
        );
        await db.query("COMMIT");
        return false;
      }
      await db.query(
        "UPDATE control.mcp_oauth_grants SET used_at=now() WHERE token_hash=$1",
        [hash],
      );
      for (const next of issue(g)) await insert(db, next);
      await db.query("COMMIT");
      return true;
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
  async revoke(hash: string, clientId: string) {
    const g = await this.get(hash);
    if (!g || g.clientId !== clientId) return;
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        g.family,
      ]);
      await db.query(
        "UPDATE control.mcp_oauth_grants SET revoked_at=now() WHERE family_id=$1",
        [g.family],
      );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }
}
