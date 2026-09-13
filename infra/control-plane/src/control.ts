import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DynamoCredentialRepository, KmsEnvelopeCipher, documentClient } from "./aws-adapters.ts";
import { LiveProviderVerifier } from "./provider-adapters.ts";
import {
  PolicyError,
  parseSafePreferences,
  requireAccountId,
  requireProvider,
  verifyAndStoreCredential,
} from "./policy.ts";

const credentials = new DynamoCredentialRepository(requiredEnv("CREDENTIALS_TABLE"));
const cipher = new KmsEnvelopeCipher(requiredEnv("CREDENTIAL_KMS_KEY_ID"));
const preferencesTable = requiredEnv("PREFERENCES_TABLE");
const verifier = new LiveProviderVerifier();

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  try {
    const accountId = requireAccountId(event.requestContext.authorizer?.claims?.sub);
    const method = event.httpMethod;
    const resource = event.resource;
    if (resource === "/credentials" && method === "GET") {
      const statuses = await Promise.all((["openrouter", "fireworks"] as const).map(async provider => {
        const item = await credentials.get(accountId, provider);
        return item ? {
          schemaVersion: 1,
          provider,
          configured: true,
          fingerprintSuffix: item.fingerprintSuffix,
          lastVerifiedAt: item.lastVerifiedAt,
          verification: item.verification,
        } : { schemaVersion: 1, provider, configured: false, verification: "never" };
      }));
      return response(200, { credentials: statuses });
    }
    if (resource === "/credentials" && method === "PUT") {
      const body = parseBody(event.body);
      const provider = requireProvider(body.provider);
      const result = await verifyAndStoreCredential({
        accountId,
        provider,
        credential: String(body.credential ?? ""),
        cipher,
        repository: credentials,
        verifier,
      });
      return response(200, { schemaVersion: 1, provider, configured: true, ...result });
    }
    if (resource === "/credentials" && method === "DELETE") {
      const provider = requireProvider(event.queryStringParameters?.provider);
      await credentials.delete(accountId, provider);
      return { statusCode: 204, headers: noStoreHeaders(), body: "" };
    }
    if (resource === "/preferences" && method === "GET") {
      const result = await documentClient.send(new GetCommand({
        TableName: preferencesTable,
        Key: { accountId },
        ConsistentRead: true,
      }));
      return response(200, result.Item?.preferences ?? null);
    }
    if (resource === "/preferences" && method === "PUT") {
      const next = parseSafePreferences(parseBody(event.body));
      const expectedRevision = Number(event.headers["if-match"] ?? event.headers["If-Match"]);
      if (!Number.isSafeInteger(expectedRevision) || next.revision !== expectedRevision + 1) {
        throw new PolicyError("revision_conflict", "If-Match must precede the next revision");
      }
      await documentClient.send(new PutCommand({
        TableName: preferencesTable,
        Item: { accountId, revision: next.revision, preferences: next },
        ConditionExpression: "attribute_not_exists(accountId) OR revision = :expected",
        ExpressionAttributeValues: { ":expected": expectedRevision },
      }));
      return response(200, next, { etag: String(next.revision) });
    }
    if (resource === "/account" && method === "GET") {
      return response(200, { schemaVersion: 1, accountId });
    }
    return response(404, { error: "not_found" });
  } catch (error) {
    if (error instanceof PolicyError) {
      return response(error.code === "revision_conflict" ? 409 : 400, { error: error.code });
    }
    if ((error as { name?: string }).name === "ConditionalCheckFailedException") {
      return response(409, { error: "revision_conflict" });
    }
    return response(503, { error: "temporarily_unavailable" });
  }
}

function parseBody(body: string | null): Record<string, unknown> {
  if (!body) throw new PolicyError("invalid_request", "Request body is required");
  try {
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new PolicyError("invalid_request", "Request body must be JSON");
  }
}

function noStoreHeaders(extra: Record<string, string> = {}) {
  return { "content-type": "application/json", "cache-control": "no-store", ...extra };
}
function response(statusCode: number, body: unknown, extra: Record<string, string> = {}) {
  return { statusCode, headers: noStoreHeaders(extra), body: JSON.stringify(body) };
}
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
